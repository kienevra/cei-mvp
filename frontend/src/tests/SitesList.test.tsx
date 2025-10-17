import React from "react";
import { render, screen } from "@testing-library/react";
import SitesList from "../pages/SitesList";
import { MemoryRouter } from "react-router-dom";

test("renders SitesList page", () => {
  render(
    <MemoryRouter>
      <SitesList />
    </MemoryRouter>
  );
  expect(screen.getByText(/Sites/i)).toBeInTheDocument();
});