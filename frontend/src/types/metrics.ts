export interface Metrics {
  id: string;
  siteId: string;
  timestamp: string;
  value: number;
  [key: string]: any;
}