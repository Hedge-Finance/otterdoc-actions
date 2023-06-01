import * as core from '@actions/core'
import axios from 'axios'

export async function VerifyOtterDocKey(key: string): Promise<boolean> {
  const result = await axios.get(
    `https://www.otterdoc.ai/api/verify-key?key=${key}`
  )

  if (result.status === 200) {
    core.warning('Key is valid')
    return true
  }
  core.warning('Key is invalid')
  core.warning(`Verify status code: ${result.status}`)
  return false
}
