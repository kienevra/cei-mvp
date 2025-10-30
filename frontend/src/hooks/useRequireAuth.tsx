import { useAuth } from './useAuth';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Redirects to /login if not authenticated.
 */
export function useRequireAuth() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!accessToken) {
      navigate('/login');
    }
  }, [accessToken, navigate]);
}