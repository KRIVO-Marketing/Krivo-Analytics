export type Property = {
  id: string;
  name: string;
  property_id: string;
  kind: "own" | "client";
  cta_event: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Info = { service_account_email: string; days_allowed: number[] };

export type Metrics = {
  property: { id: string; name: string; kind: string; property_id: string; cta_event: string | null };
  days: number;
  range: { start: string; end: string };
  generated_at: string;
  totals: {
    sessions: number; users: number; pageviews: number; events: number;
    cta_clicks: number | null; cta_users: number | null; cta_rate: number | null;
  };
  previous: { sessions: number; users: number; pageviews: number; events: number };
  change_pct: { sessions: number | null; users: number | null; pageviews: number | null };
  daily: { date: string; sessions: number; users: number; pageviews: number; events: number }[];
  sources: { source: string; medium: string; sessions: number; users: number; share: number; cta_clicks: number | null }[];
  pages: { path: string; views: number; users: number }[];
  events: { name: string; count: number; users: number }[];
  funnel: { key: string; label: string; users: number }[];
};
