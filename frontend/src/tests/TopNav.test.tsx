import '@testing-library/jest-dom';
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from '@jest/globals';
import { MemoryRouter } from "react-router-dom";
import TopNav from "../components/TopNav";
// Update the import path to the correct module that exports AuthProvider
// Update the import path to the correct module that exports AuthProvider
import { AuthProvider } from "../hooks/useAuth.tsx";

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