// Error classification for trace errors
// Maps error messages to actionable categories

export type ErrorCategory =
  | "rate_limit"
  | "timeout"
  | "auth"
  | "content_filter"
  | "context_length"
  | "network"
  | "server_error"
  | "unknown";

interface ErrorClassification {
  category: ErrorCategory;
  label: string;
  retryable: boolean;
  color: string;
  bgColor: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory }> = [
  { pattern: /rate.?limit|too many requests|429/i, category: "rate_limit" },
  {
    pattern: /timeout|timed?\s*out|ETIMEDOUT|ECONNABORTED/i,
    category: "timeout",
  },
  {
    pattern: /auth|unauthorized|forbidden|401|403|api.?key|invalid.?key/i,
    category: "auth",
  },
  {
    pattern: /content.?filter|safety|moderation|blocked|flagged/i,
    category: "content_filter",
  },
  {
    pattern:
      /context.?length|token.?limit|max.?tokens|too.?long|maximum.?context/i,
    category: "context_length",
  },
  {
    pattern: /network|ECONNREFUSED|ENOTFOUND|fetch.?failed|DNS/i,
    category: "network",
  },
  {
    pattern: /500|502|503|504|internal.?server|service.?unavailable/i,
    category: "server_error",
  },
];

const CLASSIFICATIONS: Record<ErrorCategory, ErrorClassification> = {
  rate_limit: {
    category: "rate_limit",
    label: "Rate limit",
    retryable: true,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
  },
  timeout: {
    category: "timeout",
    label: "Timeout",
    retryable: true,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
  },
  auth: {
    category: "auth",
    label: "Auth",
    retryable: false,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
  },
  content_filter: {
    category: "content_filter",
    label: "Filtered",
    retryable: false,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/30",
  },
  context_length: {
    category: "context_length",
    label: "Too long",
    retryable: false,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
  },
  network: {
    category: "network",
    label: "Network",
    retryable: true,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
  },
  server_error: {
    category: "server_error",
    label: "Server error",
    retryable: true,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
  },
  unknown: {
    category: "unknown",
    label: "Error",
    retryable: false,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
  },
};

export function classifyError(message: string): ErrorClassification {
  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return CLASSIFICATIONS[category];
    }
  }
  return CLASSIFICATIONS.unknown;
}
