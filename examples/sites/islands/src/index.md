---
title: Islands of interactivity
layout: base.jinja
---
This page is static HTML with two islands. Each is a custom element: a tag with a script that loads only on the pages that use it.

The next hike leaves at <local-time datetime="2026-06-14T15:00:00Z" ssqch:load="idle">June 14, 2026 at 15:00 UTC</local-time>.

<like-button key="home"><a href="/about/">How likes work</a></like-button>

Without JavaScript, the time reads in UTC and the button is a link. With it, the time is in your time zone and the button counts.
