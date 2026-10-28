# Presentation mode

A kiosk-style view for dashboards, meetups and trade-show screens: it cycles
through the overview, live vehicle, showroom, drives, charging, battery and
fleet views with no interaction required.

## Use

Open `/presentation`. The page advances automatically every ~20 seconds.
It is designed for a wall-mounted display or a fullscreen browser tab:

- Big type, high-contrast cards, minimal chrome
- Live state updates via SSE (no refresh needed)
- The WebGL showroom rotates the vehicle continuously

## Tips

- Any browser fullscreen (`F11`) gives a clean kiosk.
- Use the **high-contrast** or **colorblind-safe** theme (theme menu, top
  right) for projection readability.
- Point the status page at a second screen: `/status` plus its SVG badge for
  your own README or dashboard.

## Safe for public venues

Presentation mode is read-only: it performs no API writes and commands remain
behind their normal controls.
