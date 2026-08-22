export interface AccessTokenFeedback {
  valid: boolean;
  tone: 'success' | 'warning' | 'error';
  message: string;
}

function assessAccessToken(
  token: string,
  _userInputs: readonly (string | number)[] = [],
): { acceptable: boolean; reason: string } {
  if (!token) return { acceptable: false, reason: 'empty' };
  if (token.length < 16) return { acceptable: false, reason: 'too-short' };
  return { acceptable: true, reason: 'acceptable' };
}

export function accessTokenFeedback(
  token: string,
  userInputs: readonly (string | number)[],
  allowEmpty: boolean,
): AccessTokenFeedback {
  if (!token) {
    return allowEmpty
      ? {
        valid: true,
        tone: 'warning',
        message: '留空将关闭该服务端的鉴权，仅建议在本机使用。',
      }
      : {
        valid: false,
        tone: 'error',
        message: '未绑定本机地址时，远程访问必须填写令牌；请生成令牌或将主机改为 127.0.0.1。',
      };
  }

  const assessment = assessAccessToken(token, userInputs);
  if (assessment.reason === 'too-short') {
    return {
      valid: false,
      tone: 'error',
      message: '令牌至少需要 16 个字符，请继续补充或重新生成。',
    };
  }
  if (!assessment.acceptable) {
    return {
      valid: false,
      tone: 'error',
      message: '令牌容易被猜中，请使用右侧按钮生成新的随机令牌。',
    };
  }
  return {
    valid: true,
    tone: 'success',
    message: '令牌强度符合要求。',
  };
}
