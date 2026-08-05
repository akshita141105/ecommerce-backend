import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
const SENTRY_BASE_URL = "https://sentry.io/api/0";

const fetchProjectIssues = async (projectSlug, source, params) => {
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

    return response.data.map((issue) => ({
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
export const getErrors = async (req, res) => {
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
            console.error(
                "Error fetching backend Sentry issues:",
                backendResult.reason?.response?.data || backendResult.reason?.message
            );
        }
        if (frontendResult.status === "rejected") {
            console.error(
                "Error fetching frontend Sentry issues:",
                frontendResult.reason?.response?.data || frontendResult.reason?.message
            );
        }

        // Merge and sort by lastSeen (most recent first)
        const allIssues = [...backendIssues, ...frontendIssues].sort(
            (a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)
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
        console.error("Error fetching Sentry issues:", error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch errors from Sentry",
        });
    }
};

// GET /api/admin/errors/:issueId
// Fetches detailed info for a single issue, including recent events
// Note: issueId is globally unique in Sentry, so we don't need to know which project it belongs to
export const getErrorDetail = async (req, res) => {
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
        console.error("Error fetching Sentry issue detail:", error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch error detail from Sentry",
        });
    }
};