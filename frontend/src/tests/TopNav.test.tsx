import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TopNav from "../components/TopNav";
import { AuthProvider } from "../hooks/useAuth";

test("renders TopNav links", () => {
  render(
    <MemoryRouter>
      <AuthProvider>
        <TopNav />
      </AuthProvider>
    </MemoryRouter>
  );
  expect(screen.getByText(/CEI Platform/i)).toBeInTheDocument();
  expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
  expect(screen.getByText(/Sites/i)).toBeInTheDocument();
});