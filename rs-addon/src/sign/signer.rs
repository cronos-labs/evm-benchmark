use coins_bip32::ecdsa::SigningKey;
use coins_bip32::xkeys::{Parent, XPriv};
use ethers::prelude::*;
use ethers::signers::coins_bip39::Mnemonic;
use ethers::signers::{coins_bip39::English, LocalWallet};

const DERIVE_PATH: &str = "m/44'/60'/0'/0";

pub async fn get_child_signers_with_range(
  root_menmonic: &str,
  chain_id: u64,
  start_index: i64,
  end_index: i64,
) -> Vec<LocalWallet> {
  let mut set = tokio::task::JoinSet::new();
  let mnemonic = Mnemonic::<English>::new_from_phrase(root_menmonic).unwrap();
  let root_priv = mnemonic.derive_key(DERIVE_PATH, None).unwrap();

  for index in start_index..=end_index {
    let root_priv = root_priv.clone();
    set.spawn_blocking(move || {
      (
        get_child_signer_with_priv_key(root_priv, index as u32, chain_id),
        index,
      )
    });
  }

  let mut results = vec![];
  while let Some(res) = set.join_next().await {
    let idx = res.unwrap();
    results.push(idx);
  }

  results.sort_by(|a, b| a.1.cmp(&b.1));

  results.clone().into_iter().map(|r| r.0.clone()).collect()
}

pub async fn get_child_signers(
  root_menmonic: &str,
  total_sub_accounts: i64,
  chain_id: u64,
) -> Vec<LocalWallet> {
  get_child_signers_with_range(root_menmonic, chain_id, 0, total_sub_accounts - 1).await
}

pub fn get_child_signer_with_priv_key(priv_key: XPriv, index: u32, chain_id: u64) -> LocalWallet {
  let derived_priv_key = priv_key.derive_child(index).unwrap();
  let key: &coins_bip32::prelude::SigningKey = derived_priv_key.as_ref();
  let signer = SigningKey::from_bytes(&key.to_bytes()).unwrap();

  Wallet::<SigningKey>::from(signer).with_chain_id(chain_id)
}

pub fn get_child_signer(root_mnemonic: &str, index: u32, chain_id: u64) -> LocalWallet {
  let mnemonic = Mnemonic::<English>::new_from_phrase(root_mnemonic).unwrap();
  let root_priv = mnemonic.derive_key(DERIVE_PATH, None).unwrap();

  get_child_signer_with_priv_key(root_priv, index, chain_id)
}

#[cfg(test)]
mod tests {

  use crate::sign::signer::get_child_signer;
  use ethers::{abi::Address, prelude::*};

  #[tokio::test]
  async fn test_get_child_signer() {
    let root_mnemonic = "test test test test test test test test test test test junk";

    let root = get_child_signer(root_mnemonic, 0, 31337);

    assert_eq!(
      root.address(),
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
        .parse::<Address>()
        .unwrap()
    );

    let child1 = get_child_signer(root_mnemonic, 1, 31337);
    assert_eq!(
      child1.address(),
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        .parse::<Address>()
        .unwrap()
    )
  }
}
