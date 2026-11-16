// Single import point for pages. Swap the mock for the HTTP client once the backend exists;
// the method names and shapes stay the same (docs/api-contract.md).
export { api, ApiError } from './mock.js';
