export class RequestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.status = status;
  }
}

export async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new RequestError("network_error", "Could not reach the server.", 0);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body; fall through and report via the status below.
  }
  if (!response.ok) {
    throw new RequestError(
      data?.error?.code || `http_${response.status}`,
      data?.error?.message || `Request failed (${response.status}).`,
      response.status
    );
  }
  return data;
}
