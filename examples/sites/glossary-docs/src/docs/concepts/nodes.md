---
title: Nodes
description: "A node is a clearing that runs pods, and its ranger checks in every few seconds; a node that stops checking in is marked unreachable."
weight: 2
---
{% from "macros.njk" import term with context %}
A {{ term("node") }} is a clearing that runs {{ term("pod", "pods") }}.

## Node health

Each node's {{ term("ranger") }} checks in every few seconds. A node that stops checking in is marked unreachable.
