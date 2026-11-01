import { defineConfig } from 'vitepress'
import { segmentChinese } from './search'

const base = process.env.DOCS_BASE || '/docs/'
const publicDocs = process.env.DOCS_DEPLOYMENT === 'pages'
const repository = process.env.GITHUB_REPOSITORY || 'sunbroke555/tiller'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Tiller 使用手册',
  description: '从安装、连接 Proxmox VE 到日常管理，在电脑和手机上使用 Tiller。',
  base,
  cleanUrls: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],
  themeConfig: {
    appLink: publicDocs
      ? { text: '项目主页', href: `https://github.com/${repository}` }
      : { text: '返回 Tiller', href: '/' },
    logo: { src: '/favicon.svg', alt: '' },
    siteTitle: 'Tiller 文档',
    nav: [
      { text: '使用手册', link: '/' },
      { text: '快速开始', link: '/guide/install' },
    ],
    sidebar: [
      { text: '开始使用', items: [
        { text: '文档概览', link: '/' },
        { text: '安装与运行', link: '/guide/install' },
        { text: '连接与安全配置', link: '/guide/configuration' },
        { text: '首次登录', link: '/guide/first-run' },
      ] },
      { text: '日常管理', items: [
        { text: '导航与资源概览', link: '/manual/navigation' },
        { text: '虚拟机与容器', link: '/manual/guests' },
        { text: '存储、快照与备份', link: '/manual/storage-backup' },
        { text: '控制台与任务日志', link: '/manual/console-tasks' },
        { text: '节点与数据中心', link: '/manual/administration' },
        { text: '账户与权限', link: '/manual/account' },
        { text: '外观与手机使用', link: '/manual/appearance' },
      ] },
      { text: '遇到问题', items: [
        { text: '常见问题与排查', link: '/guide/troubleshooting' },
        { text: '常见名词', link: '/guide/terms' },
      ] },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换浅色',
    darkModeSwitchTitle: '切换深色',
    notFound: { title: '页面不存在', quote: '这篇文档可能已移动，请从目录或搜索重新查找。', linkLabel: '返回文档首页', linkText: '返回文档首页' },
    search: {
      provider: 'local',
      options: {
        // _render is build-only. VitePress serializes public config functions
        // with new Function(), which our CSP deliberately forbids. Segment
        // index text here; the query tokenizer is bundled by the theme.
        _render(src, env, md) {
          const html = md.render(src, env)
          if (env.frontmatter?.search === false) return ''
          // Keep heading markup/titles intact, including generated anchors.
          return html.replace(/(<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>)|>([^<]+)</g,
            (match, heading, text) => heading ? match : `>${segmentChinese(text)}<`)
        },
        locales: { root: { translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细结果', resetButtonTitle: '清空搜索',
            backButtonTitle: '关闭搜索', noResultsText: '没有找到相关内容',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        } } },
      },
    },
  },
})
