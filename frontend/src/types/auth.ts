// src/types/auth.ts

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}
