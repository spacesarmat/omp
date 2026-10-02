import 'preact/compat';
import { vi } from 'vitest';

// Mock the spatial navigation library for tests
vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({
  init: vi.fn(),
  useFocusable: () => ({
    ref: { current: null },
    focused: false,
    focusSelf: vi.fn(),
  }),
  FocusContext: {
    Provider: ({ children }: any) => children,
    Consumer: ({ children }: any) => children,
  },
  pause: vi.fn(),
  resume: vi.fn(),
}));
