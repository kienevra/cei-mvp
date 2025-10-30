import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CSVUpload from '../pages/CSVUpload';
import api from '../services/api';

jest.mock('../services/api');

const mockCsvContent = `timestamp,site_id,meter_id,value,unit\n2025-01-01,site-1,meter-1,100,kWh\n2025-01-02,site-2,meter-2,200,kWh`;

function createFile(content: string, name = 'test.csv') {
  return new File([content], name, { type: 'text/csv' });
}

describe('CSVUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders and previews CSV rows', async () => {
    render(<CSVUpload />);
    const fileInput = screen.getByLabelText(/csv/i) || screen.getByTestId('csv-input');
    const file = createFile(mockCsvContent);
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('site-1')).toBeInTheDocument();
      expect(screen.getByText('meter-2')).toBeInTheDocument();
    });
  });

  it('uploads CSV and shows success message', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { job_id: 'job-123' } });
    render(<CSVUpload />);
    const fileInput = screen.getByLabelText(/csv/i) || screen.getByTestId('csv-input');
    const file = createFile(mockCsvContent);
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('site-1')).toBeInTheDocument());
    const uploadBtn = screen.getByRole('button', { name: /upload/i });
    fireEvent.click(uploadBtn);
    await waitFor(() => expect(screen.getByText(/Job accepted: job-123/i)).toBeInTheDocument());
  });
});
