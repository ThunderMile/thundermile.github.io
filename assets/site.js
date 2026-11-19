const board = document.querySelector("[data-study]");
if (board) {
  const controls = document.querySelector(".mode-control");
  const render = board.querySelector(".mounts");
  const outline = board.querySelector(".outline");
  controls.hidden = false;
  for (const button of controls.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const drawOutline = button.dataset.mode === "outline";
      render.style.visibility = drawOutline ? "hidden" : "visible";
      outline.hidden = !drawOutline;
      outline.alt = drawOutline ? "Optical mounts and a lens tube shown in outline." : "";
      for (const mode of controls.querySelectorAll("button")) {
        mode.setAttribute("aria-pressed", String(mode === button));
      }
    });
  }
}

const viewer = document.querySelector(".lightbox");
if (viewer && typeof viewer.showModal === "function") {
  const fullImage = viewer.querySelector("img");
  for (const link of document.querySelectorAll(".shot-link")) {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      fullImage.src = link.href;
      fullImage.alt = link.querySelector("img").alt;
      viewer.showModal();
    });
  }
  viewer.querySelector("button").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
}
