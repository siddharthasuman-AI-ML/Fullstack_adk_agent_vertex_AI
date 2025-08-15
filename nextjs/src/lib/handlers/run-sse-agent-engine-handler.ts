/**
 * Agent Engine Handler for Run SSE API Route
 *
 * Handles requests for Agent Engine deployment configuration.
 * This handler processes streaming JSON fragments from Agent Engine and converts them to SSE format.
 * Note: Agent Engine returns JSON fragments (not standard SSE), so we parse and reformat them.
 */

import { getEndpointForPath, getAuthHeaders } from "@/lib/config";
import {
  ProcessedStreamRequest,
  formatAgentEnginePayload,
  logStreamStart,
  logStreamResponse,
  SSE_HEADERS,
} from "./run-sse-common";
import {
  createInternalServerError,
  createBackendConnectionError,
} from "./error-utils";

/**
 * Agent Engine JSON Fragment Types
 * Based on the actual format Agent Engine returns
 */
interface AgentEngineContentPart {
  text?: string;
  thought?: boolean;
  function_call?: {
    name: string;
    args: Record<string, unknown>;
    id: string;
  };
  function_response?: {
    name: string;
    response: Record<string, unknown>;
    id: string;
  };
}

interface AgentEngineFragment {
  content?: {
    parts?: AgentEngineContentPart[];
  };
  role?: string;
  author?: string;
  usage_metadata?: {
    candidates_token_count?: number;
    prompt_token_count?: number;
    total_token_count?: number;
    thoughts_token_count?: number;
  };
  invocation_id?: string;
  actions?: {
    state_delta?: Record<string, unknown>;
    artifact_delta?: Record<string, unknown>;
    requested_auth_configs?: Record<string, unknown>;
  };
  isFinal?: boolean; // Added for the new processor
}

/**
 * Processes JSON fragments from Agent Engine streaming response.
 * Agent Engine sends a single large JSON object with parts.
 * We look for complete part objects and stream them immediately when found.
 *
 * IMPROVED VERSION: Uses native JSON.parse() instead of manual brace counting
 * for better reliability and performance.
 */
class JSONFragmentProcessor {
  private buffer: string = "";
  private currentAgent: string = "";
  private sentParts: Set<string> = new Set(); // Track sent parts by their content hash

  constructor(
    private controller: ReadableStreamDefaultController<Uint8Array>
  ) {}

  /**
   * Process incoming chunk of data from Agent Engine.
   * Accumulates chunks and looks for complete parts to stream immediately.
   */
  processChunk(chunk: string): void {
    console.log(`🔄 [JSON PROCESSOR] Processing chunk: ${chunk.length} bytes`);
    console.log(
      `📝 [JSON PROCESSOR] Full chunk content:`,
      JSON.stringify(chunk)
    );

    this.buffer += chunk;

    // Use improved part-level parsing approach
    this.extractCompletePartsFromBuffer();
  }

  /**
   * Extract complete part objects from buffer using JSON.parse()
   * Much simpler than manual brace counting - just try to parse incrementally!
   */
  private extractCompletePartsFromBuffer(): void {
    // Find the start of the parts array if we haven't found it yet
    const partsMatch = this.buffer.match(/"parts"\s*:\s*\[/);
    if (!partsMatch) {
      return; // No parts array found yet
    }

    const partsArrayStart = partsMatch.index! + partsMatch[0].length;
    const partsContent = this.buffer.substring(partsArrayStart);

    // Look for potential object starts and try to parse them
    let searchPos = 0;

    while (searchPos < partsContent.length) {
      // Find the next potential object start
      const objStart = partsContent.indexOf("{", searchPos);
      if (objStart === -1) break; // No more objects to find

      // Try to parse increasingly larger substrings until we get a valid JSON
      for (let endPos = objStart + 1; endPos <= partsContent.length; endPos++) {
        const potentialJson = partsContent.substring(objStart, endPos);

        // Skip if it doesn't end with }
        if (!potentialJson.endsWith("}")) continue;

        try {
          const part = JSON.parse(potentialJson);

          // Check if this is a valid part object with text
          if (part.text && typeof part.text === "string") {
            const partHash = this.hashPart(part);

            if (!this.sentParts.has(partHash)) {
              console.log(
                `✅ [JSON PROCESSOR] Found new part (thought: ${
                  part.thought
                }): ${part.text.substring(0, 100)}...`
              );
              this.emitCompletePart(part);
              this.sentParts.add(partHash);
            }
          }

          // Successfully parsed! Move search position past this object
          searchPos = objStart + potentialJson.length;
          break; // Found a valid object, stop trying longer substrings
        } catch {
          // Not valid JSON yet, try a longer substring
          continue;
        }
      }

      // If we couldn't parse anything starting from this position, move forward
      if (searchPos <= objStart) {
        searchPos = objStart + 1;
      }
    }
  }

  /**
   * Create a simple hash of a part to detect duplicates
   */
  private hashPart(part: AgentEngineContentPart): string {
    // Use full text for better uniqueness and include position info
    const textHash = part.text?.substring(0, 100) || "";
    return `${textHash}-${part.thought}-${!!part.function_call}-${
      textHash.length
    }`;
  }

  /**
   * Emit a complete part as SSE format to the frontend
   * Converts from Agent Engine JSON fragments to standard SSE format
   *
   * IMPROVED: Now outputs proper SSE format for unified processing
   */
  private emitCompletePart(part: AgentEngineContentPart): void {
    console.log(
      `📤 [JSON PROCESSOR] Emitting complete part as SSE format (thought: ${part.thought}):`,
      part.text?.substring(0, 200) +
        (part.text && part.text.length > 200 ? "..." : "")
    );

    const sseData = {
      content: {
        parts: [part],
      },
      author: this.currentAgent || "goal_planning_agent",
    };

    // Convert to proper SSE format: data: {...}\n\n
    const sseEvent = `data: ${JSON.stringify(sseData)}\n\n`;
    this.controller.enqueue(Buffer.from(sseEvent));

    console.log(
      `✅ [JSON PROCESSOR] Successfully emitted complete part as SSE format`
    );
  }

  /**
   * Process a complete JSON fragment (called when we have the full response)
   */
  processCompleteFragment(fragment: AgentEngineFragment): void {
    console.log(
      `✅ [JSON PROCESSOR] Processing complete fragment for agent: ${fragment.author}`
    );
    console.log(`📋 [JSON PROCESSOR] Complete fragment content:`, fragment);

    this.currentAgent = fragment.author || "goal_planning_agent";

    // CRITICAL FIX: Process the actual content parts!
    if (fragment.content?.parts && Array.isArray(fragment.content.parts)) {
      console.log(
        `🔍 [JSON PROCESSOR] Found ${fragment.content.parts.length} parts in complete fragment`
      );

      for (const [index, part] of fragment.content.parts.entries()) {
        if (part.text && typeof part.text === "string") {
          const partHash = this.hashPart(part);

          if (!this.sentParts.has(partHash)) {
            console.log(
              `✅ [JSON PROCESSOR] Processing complete fragment part ${
                index + 1
              } (thought: ${part.thought}): ${part.text.substring(0, 100)}...`
            );
            this.emitCompletePart(part);
            this.sentParts.add(partHash);
          } else {
            console.log(
              `⏭️ [JSON PROCESSOR] Skipping duplicate part ${index + 1}`
            );
          }
        }
      }
    } else {
      console.log(
        `⚠️ [JSON PROCESSOR] No content.parts found in complete fragment`
      );
    }

    // Stream any additional data (actions, usage_metadata, etc.)
    if (
      fragment.actions ||
      fragment.usage_metadata ||
      fragment.invocation_id ||
      fragment.isFinal
    ) {
      const additionalData: Record<string, unknown> = {
        author: fragment.author || "goal_planning_agent",
      };

      if (fragment.actions) additionalData.actions = fragment.actions;
      if (fragment.usage_metadata)
        additionalData.usage_metadata = fragment.usage_metadata;
      if (fragment.invocation_id)
        additionalData.invocation_id = fragment.invocation_id;
      if (fragment.isFinal) additionalData.isFinal = fragment.isFinal;

      console.log(`📤 [JSON PROCESSOR] Emitting final metadata as SSE format`);
      const sseEvent = `data: ${JSON.stringify(additionalData)}\n\n`;
      // IMPROVED: Use Buffer.from() and emit SSE format
      this.controller.enqueue(Buffer.from(sseEvent));
    }

    // Log token usage if available
    if (fragment.usage_metadata) {
      console.log("📊 [JSON PROCESSOR] Token usage:", fragment.usage_metadata);
    }
  }

  /**
   * Finalize the stream processing
   */
  finalize(): void {
    console.log("🏁 [JSON PROCESSOR] Finalizing stream");

    // Try to parse any remaining buffer content
    if (this.buffer.trim()) {
      try {
        const fragment: AgentEngineFragment = JSON.parse(this.buffer);
        this.processCompleteFragment(fragment);
      } catch (error) {
        console.error(
          "❌ [JSON PROCESSOR] Failed to parse remaining buffer on finalize:",
          this.buffer,
          error
        );
      }
    }
  }
}

/**
 * Handle Agent Engine streaming request with JSON fragment processing
 *
 * @param requestData - Processed request data
 * @returns Streaming SSE Response with processed JSON fragments
 */
export async function handleAgentEngineStreamRequest(
  requestData: ProcessedStreamRequest
): Promise<Response> {
  console.log(
    "🚀🚀🚀 [AGENT ENGINE] NEW JSON FRAGMENT HANDLER STARTING 🚀🚀🚀"
  );
  console.log(
    `📊 [AGENT ENGINE] Request data:`,
    JSON.stringify(requestData, null, 2)
  );

  try {
    // Format payload for Agent Engine
    const agentEnginePayload = formatAgentEnginePayload(requestData);

    // Build Agent Engine URL with the streamQuery endpoint
    const agentEngineUrl = getEndpointForPath("", "streamQuery");

    // Log operation start
    logStreamStart(agentEngineUrl, agentEnginePayload, "agent_engine");

    // Get authentication headers
    const authHeaders = await getAuthHeaders();

    // Forward request to Agent Engine streaming endpoint
    const response = await fetch(agentEngineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(agentEnginePayload),
    });

    // Log the response from Agent Engine
    logStreamResponse(
      response.status,
      response.statusText,
      response.headers,
      "agent_engine"
    );

    // Check for errors from Agent Engine
    if (!response.ok) {
      let errorDetails = `Agent Engine returned an error: ${response.status} ${response.statusText}`;
      try {
        const errorText = await response.text();
        console.error(`❌ Agent Engine error details:`, errorText);
        if (errorText) {
          errorDetails += `. ${errorText}`;
        }
      } catch (error) {
        // Response body might not be available or already consumed
        console.error(
          "An error occurred while trying to read the error response body from Agent Engine:",
          error
        );
      }
      return createBackendConnectionError(
        "agent_engine",
        response.status,
        response.statusText,
        errorDetails
      );
    }

    // Create streaming response that processes JSON fragments
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          controller.error(new Error("No readable stream from Agent Engine"));
          return;
        }

        console.log(
          "🚀🚀🚀 [AGENT ENGINE] Starting JSON fragment processing 🚀🚀🚀"
        );
        console.log(
          "📋 [AGENT ENGINE] This is the NEW handler with JSONFragmentProcessor"
        );

        // Initialize JSON fragment processor
        const processor = new JSONFragmentProcessor(controller);

        // Set up timeout mechanism (5 minutes max)
        const timeoutMs = 5 * 60 * 1000; // 5 minutes
        const startTime = Date.now();
        let isStreamActive = true;

        try {
          // Read and process JSON fragments using recursive pump pattern with timeout
          const pump = async (): Promise<void> => {
            // Check for timeout
            if (Date.now() - startTime > timeoutMs) {
              console.error("❌ [AGENT ENGINE] Stream timeout after 5 minutes");
              processor.finalize();
              controller.close();
              return;
            }

            if (!isStreamActive) {
              return;
            }

            const { done, value } = await reader.read();

            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              console.log(
                `⏰ [STREAMING] Received chunk at ${new Date().toISOString()}, size: ${
                  chunk.length
                } bytes`
              );
              processor.processChunk(chunk);
            }

            if (done) {
              console.log("✅ [AGENT ENGINE] JSON fragment stream completed");
              processor.finalize();
              controller.close();
              isStreamActive = false;
              return;
            }

            // Continue processing next chunk
            return pump();
          };

          await pump();
        } catch (error) {
          console.error(
            "❌ [AGENT ENGINE] JSON fragment processing error:",
            error
          );

          // Attempt graceful error recovery
          try {
            processor.finalize();
          } catch (finalizeError) {
            console.error(
              "❌ [AGENT ENGINE] Error during finalization:",
              finalizeError
            );
          }

          controller.error(error);
        } finally {
          isStreamActive = false;
          reader.releaseLock();
        }
      },
    });

    // Return streaming SSE response with proper headers
    return new Response(stream, {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    console.error("❌ Agent Engine handler error:", error);

    if (error instanceof TypeError && error.message.includes("fetch")) {
      return createBackendConnectionError(
        "agent_engine",
        500,
        "Connection failed",
        "Failed to connect to Agent Engine"
      );
    }

    return createInternalServerError(
      "agent_engine",
      error,
      "Failed to process Agent Engine streaming request"
    );
  }
}
