"use server";

import { listUserSessions, getSessionWithEvents } from "@/lib/session-history";

/**
 * Server Action for fetching user's active sessions from ADK backend
 * This ensures we only show sessions that actually exist in the backend
 */

export interface ActiveSession {
  id: string;
  userId: string;
  appName: string;
  lastUpdateTime: Date | null;
  messageCount: number;
  title?: string;
}

export interface SessionListResult {
  success: boolean;
  sessions: ActiveSession[];
  error?: string;
}

export async function fetchActiveSessionsAction(
  userId: string
): Promise<SessionListResult> {
  try {
    // Fetch sessions from ADK backend (server-side)
    const result = await listUserSessions(userId);

    // Add defensive programming to handle empty or malformed sessions
    if (!result || !result.sessions || !Array.isArray(result.sessions)) {
      console.warn("⚠️ [SESSION_LIST_ACTION] No valid sessions returned from backend");
      return {
        success: true,
        sessions: [],
      };
    }

    console.log("🔍 [SESSION_LIST_ACTION] Processing sessions:", {
      sessionsCount: result.sessions.length,
      sessionIds: result.sessions.map(s => s.id).filter(Boolean)
    });

    // Fetch session details with events for each session in parallel to get real message counts
    const sessionDetailsPromises = result.sessions
      .filter(session => session && session.id) // Filter out invalid sessions
      .map(async (session) => {
      try {
        const sessionWithEvents = await getSessionWithEvents(
          userId,
          session.id
        );
        const messageCount = sessionWithEvents?.events?.length || 0;

        return {
          id: session.id,
          userId: session.user_id,
          appName: session.app_name,
          lastUpdateTime: session.last_update_time
            ? new Date(session.last_update_time)
            : null,
          messageCount,
          title: `Session ${session.id.substring(0, 8)}`, // Generate a title from session ID
        };
      } catch (error) {
        console.warn(
          `⚠️ [SESSION_LIST_ACTION] Failed to get events for session ${session.id}:`,
          error
        );
        // Return session with 0 message count if events fetch fails
        return {
          id: session.id,
          userId: session.user_id,
          appName: session.app_name,
          lastUpdateTime: session.last_update_time
            ? new Date(session.last_update_time)
            : null,
          messageCount: 0,
          title: `Session ${session.id.substring(0, 8)}`,
        };
      }
    });

    // Wait for all session details to be fetched
    const activeSessions: ActiveSession[] = await Promise.all(
      sessionDetailsPromises
    );

    return {
      success: true,
      sessions: activeSessions,
    };
  } catch (error) {
    console.error(
      "❌ [SESSION_LIST_ACTION] Error fetching active sessions:",
      error
    );
    return {
      success: false,
      sessions: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
