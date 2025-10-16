import React from "react";
import { render, screen } from "@testing-library/react";
import SitesList from "../pages/SitesList";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

test("renders SitesList heading", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <SitesList />
      </BrowserRouter>
    </QueryClientProvider>
  );
  expect(screen.getByText(/Sites/i)).toBeInTheDocument();
});