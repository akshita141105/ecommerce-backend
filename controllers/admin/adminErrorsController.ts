// controllers/admin/adminErrorsController.ts
import type { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import logger from "../../utils/logger.js";
dotenv.config();
const SENTRY_BASE_URL = "https://sentry.io/api/0";

interface SentryIssue {
    id: string;
    title: string;
    culprit: string;
    level: string;
    status: string;
    count: string;
    userCount: number;
    firstSeen: string;
    lastSeen: string;
    permalink: string;
    shortId: string;
    source: "backend" | "frontend";
}

interface SentryRawIssue {
    id: string;
    title: string;
    culprit: string;
    level: string;
    status: string;
    count: string;
    userCount: number;
    firstSeen: string;
    lastSeen: string;
    permalink: string;
    shortId: string;
}

const fetchProjectIssues = async (
    projectSlug: string | undefined,
    source: "backend" | "frontend",
    params: Record<string, unknown>
): Promise<SentryIssue[]> => {
    const { SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG } = process.env;

    const response = await axios.get(
        `${SENTRY_BASE_URL}/projects/${SENTRY_ORG_SLUG}/${projectSlug}/issues/`,
        {
            headers: {
                Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
            },
            params,
        }
    );

    return response.data.map((issue: SentryRawIssue) => ({
        id: issue.id,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        status: issue.status,
        count: issue.count,
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink,
        shortId: issue.shortId,
        source, // "backend" or "frontend"
    }));
};

// GET /api/admin/errors
// Fetches recent issues from BOTH backend and frontend Sentry projects
export const getErrors = async (req: Request, res: Response) => {
    try {
        const {
            SENTRY_AUTH_TOKEN,
            SENTRY_ORG_SLUG,
            SENTRY_BACKEND_PROJECT_SLUG,
            SENTRY_FRONTEND_PROJECT_SLUG,
        } = process.env;

        if (
            !SENTRY_AUTH_TOKEN ||
            !SENTRY_ORG_SLUG ||
            !SENTRY_BACKEND_PROJECT_SLUG ||
            !SENTRY_FRONTEND_PROJECT_SLUG
        ) {
            return res.status(500).json({
                success: false,
                message: "Sentry environment variables are not configured properly",
            });
        }

        const { statsPeriod = "24h", query = "is:unresolved", limit = 25 } = req.query;
        const params = { statsPeriod, query, limit };

        // Fetch both projects in parallel; don't let one failure kill the other
        const [backendResult, frontendResult] = await Promise.allSettled([
            fetchProjectIssues(SENTRY_BACKEND_PROJECT_SLUG, "backend", params),
            fetchProjectIssues(SENTRY_FRONTEND_PROJECT_SLUG, "frontend", params),
        ]);

        const backendIssues =
            backendResult.status === "fulfilled" ? backendResult.value : [];
        const frontendIssues =
            frontendResult.status === "fulfilled" ? frontendResult.value : [];

        if (backendResult.status === "rejected") {
            logger.error(
                "Error fetching backend Sentry issues:",
                backendResult.reason?.response?.data || backendResult.reason?.message
            );
        }
        if (frontendResult.status === "rejected") {
            logger.error(
                "Error fetching frontend Sentry issues:",
                frontendResult.reason?.response?.data || frontendResult.reason?.message
            );
        }

        // Merge and sort by lastSeen (most recent first)
        const allIssues = [...backendIssues, ...frontendIssues].sort(
            (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
        );

        return res.status(200).json({
            success: true,
            count: allIssues.length,
            backendCount: backendIssues.length,
            frontendCount: frontendIssues.length,
            issues: allIssues,
            warnings: {
                backendFailed: backendResult.status === "rejected",
                frontendFailed: frontendResult.status === "rejected",
            },
        });
    } catch (error) {
        const err = error as { response?: { data?: unknown }; message?: string };
        logger.error("Error fetching Sentry issues:", err?.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch errors from Sentry",
        });
    }
};

// GET /api/admin/errors/:issueId
// Fetches detailed info for a single issue, including recent events
// Note: issueId is globally unique in Sentry, so we don't need to know which project it belongs to
export const getErrorDetail = async (req: Request, res: Response) => {
    try {
        const { SENTRY_AUTH_TOKEN } = process.env;
        const { issueId } = req.params;

        if (!SENTRY_AUTH_TOKEN) {
            return res.status(500).json({
                success: false,
                message: "Sentry environment variables are not configured properly",
            });
        }

        const [issueRes, eventsRes] = await Promise.all([
            axios.get(`${SENTRY_BASE_URL}/issues/${issueId}/`, {
                headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` },
            }),
            axios.get(`${SENTRY_BASE_URL}/issues/${issueId}/events/`, {
                headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` },
                params: { limit: 10 },
            }),
        ]);

        return res.status(200).json({
            success: true,
            issue: issueRes.data,
            recentEvents: eventsRes.data,
        });
    } catch (error) {
        const err = error as { response?: { data?: unknown }; message?: string };
        logger.error("Error fetching Sentry issue detail:", err?.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch error detail from Sentry",
        });
    }
};
