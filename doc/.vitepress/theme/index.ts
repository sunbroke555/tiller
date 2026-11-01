import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import { tokenizeSearch } from '../search'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ siteData }) {
    const search = siteData.value.themeConfig.search
    if (search?.provider === 'local') {
      // Dev site data is deeply readonly; replace it instead of mutating it.
      siteData.value = {
        ...siteData.value,
        themeConfig: {
          ...siteData.value.themeConfig,
          search: { ...search, options: { ...search.options, miniSearch: { options: { tokenize: tokenizeSearch } } } },
        },
      }
    }
  },
} satisfies Theme
