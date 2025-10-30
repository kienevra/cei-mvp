// src/types/site.ts

export interface SiteSummary {
  id: string;
  name: string;
  location?: string;
  meta?: Record<string, any>;
}

export interface SiteDetail extends SiteSummary {
  description?: string;
  created_at?: string;
  updated_at?: string;
  // Add more fields as needed
}

export interface SitesListResponse {
  items: SiteSummary[];
  total?: number;
  page?: number;
  per_page?: number;
}

export type Site = {
  id: string;
  name: string;
  location?: string;
  status?: string;
  updated_at?: string;
  [key: string]: any;
};
