import { expect, test } from '../fixtures'

// Read-only interaction regression: no settings are saved. Covers Radix
// presence/focus, Vaul dismissal and virtualized choices after motion changes.
test.beforeEach(async ({ page, pve }) => {
  await page.goto(`/node/${pve.node}/system`)
  await expect(page.getByRole('button', { name: '编辑 DNS' })).toBeVisible()
})

test('dialogs can close and reopen immediately without leaving the page locked', async ({ page, mobile }) => {
  const trigger = page.getByRole('button', { name: '编辑 DNS' })
  for (let i = 0; i < 3; i++) {
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'DNS', exact: true })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
    const overlay = page.locator('[data-slot$="-overlay"]')
    expect(await overlay.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    if (!mobile) await expect(trigger).toBeFocused()
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none')
})

test('discard confirmation keeps input until explicitly discarded', async ({ page }) => {
  await page.getByRole('button', { name: '编辑 DNS' }).click()
  const dialog = page.getByRole('dialog', { name: 'DNS', exact: true })
  await dialog.getByLabel('搜索域').fill('unsaved.example')
  await page.keyboard.press('Escape')
  const confirm = page.getByRole('alertdialog', { name: '放弃更改？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '继续编辑' }).click()
  await expect(confirm).toBeHidden()
  await expect(dialog.getByLabel('搜索域')).toHaveValue('unsaved.example')
  await page.keyboard.press('Escape')
  await confirm.getByRole('button', { name: '放弃', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(confirm).toBeHidden()
})

test('timezone search and keyboard navigation reach choices outside the rendered window', async ({ page }) => {
  await page.getByRole('button', { name: /^时区/ }).click()
  const dialog = page.getByRole('dialog', { name: '时区', exact: true })
  const checked = dialog.getByRole('radio', { checked: true })
  await expect(checked).toBeInViewport()
  expect(await dialog.getByRole('radio').count()).toBeLessThan(20)
  const total = await checked.getAttribute('aria-setsize')
  await checked.focus()
  await page.keyboard.press('End')
  await expect(dialog.locator(`[role=radio][aria-posinset="${total}"]`)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(dialog.locator('[role=radio][aria-posinset="1"]')).toBeFocused()
  await dialog.getByRole('textbox', { name: '搜索时区' }).fill('上海')
  await expect(dialog.getByRole('radio')).toHaveCount(1)
  await dialog.getByRole('radio', { name: 'Asia/Shanghai' }).click()
  await expect(dialog.getByRole('radio', { name: 'Asia/Shanghai' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('textbox', { name: '搜索时区' }).fill('')
  await expect(dialog.getByRole('radio', { name: 'Asia/Shanghai' })).toBeInViewport()
  await dialog.getByRole('button', { name: '取消' }).click()
})

test('nested select opens and returns to its parent dialog', async ({ page }) => {
  await page.getByRole('button', { name: /^Wake-on-LAN/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Wake-on-LAN', exact: true })
  await dialog.getByLabel('MAC 地址').fill('02:00:00:00:00:01')
  await dialog.getByRole('combobox', { name: '发送接口' }).click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  expect(await list.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
})

test('reduced motion also applies to the dialog and its backdrop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '编辑 DNS' }).click()
  const dialog = page.getByRole('dialog', { name: 'DNS', exact: true })
  await expect(dialog).toBeVisible()
  for (const locator of [dialog, page.locator('[data-slot$="-overlay"]')]) {
    expect(await locator.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(0.001)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('mobile drawer still follows a drag and dismisses', { tag: '@mobile' }, async ({ page }) => {
  await page.getByRole('button', { name: '编辑 DNS' }).click()
  const dialog = page.getByRole('dialog', { name: 'DNS', exact: true })
  await expect(dialog).toBeVisible()
  // Vaul ignores drags in the first 500 ms after opening to avoid accidental
  // dismissal from the opening gesture; keep that library behavior intact.
  await page.waitForTimeout(550)
  const bounds = (await dialog.boundingBox())!
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + 16
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, Math.min(y + bounds.height * 0.7, 830), { steps: 12 })
  await page.mouse.up()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '编辑 DNS' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
})
