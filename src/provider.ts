import type { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'
import { _TypedDataEncoder } from '@ethersproject/hash'
import type { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers'

import { getPeerMeta } from './walletconnect'

// These are wallets which do not implement eth_signTypedData_v4, but *do* implement eth_signTypedData.
// They are special-cased so that signing will still use EIP-712 (which is safer for the user).
const WALLETS_LACKING_V4_SUPPORT = ['SafePal Wallet']

function supportsV4(provider: JsonRpcProvider): boolean {
  const name = getPeerMeta(provider)?.name

  // By default, we assume v4 support.
  if (name && WALLETS_LACKING_V4_SUPPORT.includes(name)) {
    return false
  }

  return true
}

/**
 * Signs TypedData with EIP-712, if available, or else by falling back to eth_sign.
 * Calls eth_signTypedData_v4, or eth_signTypedData for wallets with incomplete EIP-712 support.
 *
 * @see https://github.com/ethers-io/ethers.js/blob/c80fcddf50a9023486e9f9acb1848aba4c19f7b6/packages/providers/src.ts/json-rpc-provider.ts#L334
 */
export async function signTypedData(
  signer: JsonRpcSigner,
  domain: TypedDataDomain,
  types: Record<string, TypedDataField[]>,
  // Use Record<string, any> for the value to match the JsonRpcSigner._signTypedData signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: Record<string, any>
) {
  // Populate any ENS names (in-place)
  const populated = await _TypedDataEncoder.resolveNames(domain, types, value, (name: string) => {
    return signer.provider.resolveName(name) as Promise<string>
  })

  const method = supportsV4(signer.provider) ? 'eth_signTypedData_v4' : 'eth_signTypedData'
  const address = (await signer.getAddress()).toLowerCase()
  const message = JSON.stringify(_TypedDataEncoder.getPayload(populated.domain, types, populated.value))

  try {
    return await signer.provider.send(method, [address, message])
  } catch (error) {
    // If eth_signTypedData is unimplemented, fall back to eth_sign.
    if (typeof error.message === 'string' && error.message.match(/not (found|implemented)/i)) {
      console.warn('signTypedData: wallet does not implement EIP-712, falling back to eth_sign', error.message)
      const hash = _TypedDataEncoder.hash(populated.domain, types, populated.value)
      return await signer.provider.send('eth_sign', [address, hash])
    }
    throw error
  }
}