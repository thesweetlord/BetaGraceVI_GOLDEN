export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const getRandomByte = () => {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      return crypto.getRandomValues(new Uint8Array(1))[0] & 0xff;
    }
    return Math.floor(Math.random() * 256);
  };

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = getRandomByte() % 16;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
