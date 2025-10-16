import React from "react";
import { useAuth } from "../hooks/useAuth";

export default function Account() {
  const { token, logout } = useAuth();
  return (
    <div>
      <h1>Account</h1>
      <p>Token: <code>{token}</code></p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}