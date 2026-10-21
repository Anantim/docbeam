/** The one place on the page where tooltips and popovers are drawn: above every card and scroll area, so none of them is clipped (D-F1-42, D-F1-47). */
export function overlayRoot(): HTMLElement {
  let root = document.getElementById('overlay-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'overlay-root';
    document.body.appendChild(root);
  }
  return root;
}
