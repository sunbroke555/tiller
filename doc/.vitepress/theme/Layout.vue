<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'

const { theme } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-content-after>
      <a class="tiller-return" :href="theme.appLink.href" target="_self">{{ theme.appLink.text }} <span aria-hidden="true">↗</span></a>
    </template>
  </DefaultTheme.Layout>
</template>
