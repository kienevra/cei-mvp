import { useQuery } from "@tanstack/react-query";
import api from "../services/api";

export function useApi<T = any>(path: string, options?: object) {
  return useQuery<T, Error>({
    queryKey: [path],
    queryFn: async () => {
      const res = await api.get<T>(path, options);
      return res.data;
    },
  });
}