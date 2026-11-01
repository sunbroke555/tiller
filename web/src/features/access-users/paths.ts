// Routes of the datacenter section "用户与令牌" (/datacenter/users/*).

const BASE = '/datacenter/users'

export const usersPath = () => BASE
export const userPath = (userid: string) => `${BASE}/user/${encodeURIComponent(userid)}`
export const groupsPath = () => `${BASE}/groups`
export const groupPath = (groupid: string) => `${BASE}/groups/${encodeURIComponent(groupid)}`
export const tokensPath = () => `${BASE}/tokens`
export const tfaPath = () => `${BASE}/tfa`
