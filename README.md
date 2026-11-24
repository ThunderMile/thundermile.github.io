# Mile Huang’s portfolio

[Home](https://thundermile.github.io/) shows Mile’s player card and shared activity. [Experience](https://thundermile.github.io/experience/) features the UW–Madison LOCI microscope visualization and links to the full project.

The homepage uses plain HTML, CSS and JavaScript. It reads public activity from a Cloudflare Worker. Discord supplies the current game title and icon, and authenticated Apple Watch workout events take priority. The write token belongs in Cloudflare secrets and the private iPhone Shortcuts.

The [setup guide](backend/SETUP.md) covers local preview, tests, production URLs and the existing workout automations. GitHub Pages publishes the root of `main`. The microscope project is documented in the [WideField Assembly repository](https://github.com/uw-loci/WideFieldAssembly). DM Sans uses the [SIL Open Font License](assets/fonts/OFL.txt).
