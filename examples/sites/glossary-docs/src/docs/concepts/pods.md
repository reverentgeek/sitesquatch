---
title: Pods
weight: 1
aliases: [/docs/pods/, /concepts/pods.html]
---
{% from "macros.njk" import term with context %}
A {{ term("pod") }} is the unit you deploy. Every pod runs on one {{ term("node") }}.

## Pod lifecycle

A pod is pending, then running, then finished. The {{ term("ranger") }} on its node reports each change.

::: caution Don't share snacks
Squatches in different pods can't share snacks. Put them in one pod if they must.
:::

## Working with pods

> [!NOTE]
> Most of the time you don't create pods yourself; a herd creates them for you.
