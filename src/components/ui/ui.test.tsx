import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, formatTime } from './ui';

describe('UI primitives', () => {
  it('renders an accessible empty state', () => {
    render(<EmptyState title="Nothing here" body="Add a source to begin." />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
  });
  it('formats playback time', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3661)).toBe('1:01:01');
  });
});
