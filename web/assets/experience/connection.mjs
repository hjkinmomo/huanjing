// Connection facts belong to the service layer, not to individual page lifecycles.
// A configured credential is not proof that an external model answered.
export async function inspectConnection(request,slot='chat') {
  let health;
  try { health = await request('/v1/health', null, 5000); }
  catch { return {connected:false, credential:false, phase:'gateway-unavailable'}; }
  if (health?.capabilities?.desktop_gateway !== true) {
    return {connected:false, credential:false, phase:'wrong-entry'};
  }
  let vault;
  try { vault = await request('/v1/credentials/status', null, 5000); }
  catch { return {connected:true, credential:false, phase:'credentials-unavailable'}; }
  const configured = vault?.slots?.[slot]?.configured;
  if (typeof configured !== 'boolean') {
    return {connected:true, credential:false, phase:'credentials-invalid'};
  }
  return {connected:true, credential:configured, phase:configured?'configured':'needs-credential'};
}

export function connectionPresentation(connection, settings = {}) {
  const ready = connection.connected === true && connection.credential === true
    && !!String(settings.baseUrl || '').trim() && !!String(settings.model || '').trim();
  if (ready) return {ready, label:'模型已配置', detail:'本机服务可用，聊天凭据已保存。实际模型响应以发送结果为准，也可使用下方验证检查生成接口。'};
  const states = {
    checking:['正在检查连接','正在检查本机服务与聊天凭据。'],
    'gateway-unavailable':['本机服务未连接','无法连接本机网关。请检查项目是否已启动，再重新检查。'],
    'wrong-entry':['打开方式不正确','当前入口不是 Hermes 同源网关。请使用项目启动脚本提供的网址。'],
    'credentials-unavailable':['凭据检查失败','本机服务已连接，但暂时无法检查聊天凭据。请重新检查；这不代表凭据已丢失。'],
    'credentials-invalid':['凭据状态异常','本机服务已连接，但凭据状态格式不兼容。请检查前后端版本，再重新检查。'],
    'needs-credential':['尚未保存密钥','本机服务已连接。请在模型连接页保存聊天密钥，然后测试模型。'],
    configured:['模型设置待补全','已找到本机凭据，请填写服务地址和模型。'],
  };
  const [label,detail] = states[connection.phase] || ['连接检查失败','暂时无法确认连接状态，请重新检查。'];
  return {ready:false,label,detail};
}
