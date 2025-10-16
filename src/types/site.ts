export interface Site {
  id: string;
  name: string;
  location?: string;
  status?: string;
  updatedAt?: string;
  [key: string]: any;
}