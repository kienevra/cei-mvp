import React from "react";
import { render, screen } from "@testing-library/react";
import TopNav from "../components/TopNav";
import { AuthProvider } from "../hooks/useAuth";
import { BrowserRouter } from "react-router-dom";

test("renders TopNav links", () => {
  render(
    <AuthProvider>
      <BrowserRouter>
        <TopNav />
      </BrowserRouter>
    </AuthProvider>
  );
  expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
  expect(screen.getByText(/Sites/i)).toBeInTheDocument();
  expect(screen.getByText(/Account/i)).toBeInTheDocument();
});