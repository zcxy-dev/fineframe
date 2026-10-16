/** The edit cannot be made from what it was given; the message says why, and what to do. */
export class EditError extends Error {
  override name = "EditError";
}
