import React from "react";
import { render, screen } from "@testing-library/react";
import SitesList from "../pages/SitesList";
import { MemoryRouter } from "react-router-dom";
// Add this import if your environment does not provide expect globally
// ...existing code...

test("renders SitesList page", () => {
  render(
    <MemoryRouter>
      <SitesList />
    </MemoryRouter>
  );
  expect(screen.getByText(/Sites/i)).toBeInTheDocument();
});