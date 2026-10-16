// The categories come from /api/state, so they are defined once, in vebench/review.py.

/**
 * @typedef {object} State
 * @property {{ key: string, label: string }[]} categories
 * @property {number} total
 * @property {number} rated
 * @property {number | null} task
 * @property {string[]} sides ["a"] for an edit rated alone, ["a", "b"] for two versions of one.
 * @property {string} session Ties the task numbers to the server run that shuffled them.
 */

const form = /** @type {HTMLFormElement} */ (document.getElementById("rating"));
const how = /** @type {HTMLElement} */ (document.getElementById("how"));
const choice = /** @type {HTMLFieldSetElement} */ (document.getElementById("choice"));
const progress = /** @type {HTMLElement} */ (document.getElementById("progress"));
const error = /** @type {HTMLElement} */ (document.getElementById("error"));
const submit = /** @type {HTMLButtonElement} */ (form.querySelector("button[type=submit]"));
const done = /** @type {HTMLElement} */ (document.getElementById("done"));
const sides = ["a", "b"];
/** @param {string} id */
const element = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} side */
const video = (side) => /** @type {HTMLVideoElement} */ (element(`video-${side}`));
/** @param {string} side */
const videoError = (side) => /** @type {HTMLElement} */ (video(side).nextElementSibling);
/** @param {string} side */
const scales = (side) =>
  /** @type {HTMLElement} */ (form.querySelector(`.scales[data-side="${side}"]`));
const restart = "Start vebench review again and open the address it prints.";
/** @type {State} */
let state;

/**
 * @param {string} side
 * @param {string} key
 * @param {string} label
 * @param {string} title The edit's heading, read before the label so each scale says whose it is.
 */
function scale(side, key, label, title) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "scale";
  const legend = document.createElement("legend");
  const which = document.createElement("span");
  which.className = "visually-hidden";
  which.textContent = `${title}: `;
  legend.append(which, label);
  const steps = document.createElement("div");
  steps.className = "steps";
  for (let n = 1; n <= 5; n++) {
    const option = document.createElement("label");
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name: `${side}.${key}`, value: n, required: n === 1 });
    if (n === 1 || n === 5)
      input.setAttribute("aria-label", `${n}, ${n === 1 ? "poor" : "excellent"}`);
    const text = document.createElement("span");
    text.textContent = String(n);
    option.append(input, text);
    steps.append(option);
  }
  fieldset.append(legend, steps);
  return fieldset;
}

/**
 * @param {State} next
 * @param {boolean} moveFocus
 */
function show(next, moveFocus) {
  state = next;
  error.textContent = "";
  for (const side of sides) video(side).pause();
  if (next.task === null) {
    progress.textContent = `${next.rated} of ${next.total} rated`;
    form.hidden = true;
    done.hidden = false;
    if (moveFocus) document.getElementById("done-title")?.focus();
    return;
  }
  const alone = next.sides.length === 1;
  progress.textContent = `Rating ${next.rated + 1} of ${next.total}`;
  how.textContent = alone
    ? "Watch the edit, then score it from 1 (poor) to 5 (excellent)."
    : "Watch both edits, score each from 1 (poor) to 5 (excellent), then pick the one you would rather post.";
  form.reset();
  form.classList.toggle("alone", alone);
  for (const side of sides) {
    const shown = next.sides.includes(side);
    const title = alone ? "Edit" : `Edit ${side.toUpperCase()}`;
    element(`edit-${side}`).hidden = !shown;
    element(`title-${side}`).textContent = title;
    videoError(side).hidden = true;
    // A hidden side keeps no inputs, so its required scales cannot block saving.
    scales(side).replaceChildren(
      ...(shown ? next.categories.map(({ key, label }) => scale(side, key, label, title)) : []),
    );
    if (shown) {
      video(side).src = `media/${next.session}/${next.task}/${side}`;
    } else {
      video(side).removeAttribute("src");
      video(side).load();
    }
  }
  // A disabled fieldset's radio is not required, so an edit rated alone can be saved.
  choice.disabled = alone;
  choice.hidden = alone;
  form.hidden = false;
  // Keyboard and screen-reader users start the next task from its top, not the old button.
  if (moveFocus) document.getElementById("title-a")?.focus();
}

for (const side of sides) {
  // Two soundtracks at once cannot be judged, so starting one edit pauses the other.
  video(side).addEventListener("play", () => {
    for (const other of sides) if (other !== side) video(other).pause();
  });
  video(side).addEventListener("error", () => {
    videoError(side).hidden = false;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const scores = Object.fromEntries(
    state.sides.map((side) => [
      side,
      Object.fromEntries(
        state.categories.map(({ key }) => [key, Number(data.get(`${side}.${key}`))]),
      ),
    ]),
  );
  /** @type {{ session: string, task: number | null, scores: object, preferred?: string | null }} */
  const body = { session: state.session, task: state.task, scores };
  if (state.sides.length === 2) {
    const preferred = data.get("preferred");
    body.preferred = preferred === "none" ? null : String(preferred);
  }
  submit.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reply = await response.json();
    if (!response.ok) throw new Error(reply.error);
    show(reply, true);
  } catch (err) {
    // fetch rejects with a TypeError only when the server cannot be reached.
    error.textContent =
      err instanceof TypeError
        ? `Not saved: the vebench server is not running. ${restart}`
        : `Not saved: ${err instanceof Error ? err.message : err}.`;
  } finally {
    submit.disabled = false;
  }
});

fetch("api/state")
  .then((response) => (response.ok ? response.json() : Promise.reject(response)))
  .then((/** @type {State} */ first) => show(first, false))
  .catch(() => {
    progress.textContent = `Cannot reach the vebench server. ${restart}`;
  });
