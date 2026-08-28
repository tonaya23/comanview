import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('Super Admin application smoke', () => {
  it('renders the session restoration boundary before exposing Cloud data', () => {
    expect(renderToString(<App />)).toContain('Restaurando sesión Cloud');
  });
});
