import ora, { type Ora } from 'ora';

export function startSpinner(text: string): Ora {
  return ora(text).start();
}
