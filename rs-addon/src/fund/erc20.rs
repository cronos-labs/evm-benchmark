use crate::fund::batch_transfer_contract::{
  estimate_gas_erc20, BatchTransferV1Calls, MultisendTokenCall, BATCH_SIZE, ERC20,
};
use crate::sign::signer::{get_child_signer, get_child_signers, get_child_signers_with_range};
use std::process::exit;
use std::sync::Arc;

use ethers::prelude::*;

use ethers::signers::LocalWallet;

use anyhow::{Context, Result};
use hex::ToHex;
use transaction::eip2718::TypedTransaction;

async fn fund_tokens(
  level: usize,
  index: usize,
  total_index: usize,
  signer: LocalWallet,
  http_provider: String,
  token_address: Address,
  contract_address: Address,
  to_addresses: Vec<Address>,
  per_holding: Vec<U256>,
  chain_id: U256,
) -> Result<()> {
  if to_addresses.len() > BATCH_SIZE {
    panic!("[ERC20] to_addresses length should be less than 200")
  }

  let provider = Provider::<Http>::try_from(http_provider.clone())
    .with_context(|| "Failed to create provider".to_string())?;

  let signer_address = signer.address();

  let signer = signer.with_chain_id(chain_id.low_u64());
  let client = SignerMiddleware::new(provider.clone(), signer);
  let nonce = client
    .get_transaction_count(signer_address, None)
    .await
    .with_context(|| "Failed to get nonce".to_string())?;

  let client = Arc::new(client);

  let total_amount = per_holding.iter().fold(U256::zero(), |acc, x| acc + x);

  let readable_amount = ethers::utils::format_ether(total_amount);

  log::info!(
    "[ERC20] Level ({}/2), Round ({}/{}) ",
    level,
    index + 1,
    total_index
  );
  log::info!(
    "funding from: 0x{}, value: {} ERC20",
    signer_address.encode_hex::<String>(),
    readable_amount
  );
  let token_contract = ERC20::new(token_address, client.clone());
  let approval_tx = token_contract
    .approve(contract_address, U256::max_value())
    .nonce(nonce);
  let pending_tx = approval_tx.send().await;
  match pending_tx {
    Ok(tx) => {
      let receipt: Option<TransactionReceipt> =
        tx.await.with_context(|| "Failed to wait for receipt")?;
      match receipt {
        Some(receipt) => {
          log::info!(
            "[ERC20] Level ({}/2), Round ({}/{}): ",
            level,
            index + 1,
            total_index
          );
          log::info!("Approve done, tx: {:?}", receipt.transaction_hash);
        }
        None => {
          log::info!(
            "[ERC20] Level ({}/2), Round ({}/{}): ",
            level,
            index + 1,
            total_index
          );
          log::info!("Approve done: no receipt");
        }
      }
    }
    Err(e) => {
      log::info!(
        "[ERC20] Level ({}/2), Round ({}/{}): ",
        level,
        index + 1,
        total_index
      );
      log::error!("Approve failed: {}", e);
      exit(-1);
    }
  }

  let calldata = BatchTransferV1Calls::MultisendToken(MultisendTokenCall {
    token: token_address,
    contributors: to_addresses.clone(),
    amounts: per_holding.clone(),
  });
  let calldata = ethers::core::abi::AbiEncode::encode(calldata);
  let from = client.signer().address();

  let fee = client
    .estimate_eip1559_fees(None)
    .await
    .with_context(|| "Failed to estimate eip1559 fee".to_string())?; // estimate gas price

  let estimate_gas = estimate_gas_erc20(
    client.signer().clone(),
    http_provider.clone(),
    token_address,
    contract_address,
    to_addresses.clone(),
    per_holding.clone(),
  )
  .await
  .with_context(|| "Failed to estimate gas".to_string())?;

  let transaction_request = Eip1559TransactionRequest {
    to: Some(contract_address.into()),
    data: Some(calldata.into()),
    nonce: Some(nonce + 1),
    value: None,
    max_fee_per_gas: Some(fee.0),
    max_priority_fee_per_gas: Some(fee.1),
    chain_id: Some(chain_id.low_u64().into()),
    from: Some(from),
    gas: Some(estimate_gas.gas),
    access_list: vec![].into(),
  };

  let typed_tx = TypedTransaction::Eip1559(transaction_request);

  let pending_tx = client.send_transaction(typed_tx, None).await;

  match pending_tx {
    Ok(tx) => {
      let receipt: Option<TransactionReceipt> =
        tx.await.with_context(|| "Failed to wait for receipt")?;
      match receipt {
        Some(receipt) => {
          log::info!(
            "[ERC20] Level ({}/2), Round ({}/{}): ",
            level,
            index + 1,
            total_index
          );
          log::info!("funding request: done, tx: {:?}", receipt.transaction_hash);
          anyhow::Ok(())
        }
        None => {
          log::info!(
            "[ERC20] Level ({}/2), Round ({}/{}): ",
            level,
            index + 1,
            total_index
          );
          log::info!("funding request:  no receipt");
          anyhow::Ok(())
        }
      }
    }
    Err(e) => {
      log::info!(
        "[ERC20] Level ({}/2), Round ({}/{}): ",
        level,
        index + 1,
        total_index
      );
      log::info!(
        "funding request: failed: from: 0x{}, value: {}, error {}",
        signer_address.encode_hex::<String>(),
        total_amount,
        e
      );
      log::info!(
        "[ERC20] Level ({}/2), Round ({}/{}): ",
        level,
        index + 1,
        total_index
      );
      panic!("funding request failed");
    }
  }
}

// use the root signer of the mnemonic to fund start_index to end_index wallet in the same mnemonic with per_holding
async fn prefund(
  sender: LocalWallet,
  mnemonic: String,
  http_provider: String,
  start_index: usize,
  end_index: usize,
  per_holding: U256,
  token_address: Address,
  contract_address: Address,
  chain_id: U256,
) -> Result<()> {
  let mut total_count = end_index - start_index;
  let batch_count = total_count / BATCH_SIZE;

  let batch_count = if total_count % BATCH_SIZE != 0 {
    batch_count + 1
  } else {
    batch_count
  };
  if total_count == 0 || batch_count == 0 {
    return anyhow::Ok(());
  }

  for n in 0..batch_count {
    let current_size = if total_count >= BATCH_SIZE {
      BATCH_SIZE
    } else {
      total_count
    };
    let start_index = start_index + n * BATCH_SIZE;
    let end_index = start_index + current_size - 1;

    let addresses =
      get_child_signers_with_range(&mnemonic, 1, start_index as i64, end_index as i64)
        .await
        .into_iter()
        .map(|x| x.address())
        .collect::<Vec<Address>>();

    let holding_each = per_holding * BATCH_SIZE;
    total_count -= addresses.len();
    let hold_each_str = ethers::utils::format_ether(holding_each);
    let holding_each = vec![holding_each; addresses.len()];

    log::info!(
      "[ERC20] Level (1/2), Round {}/{}, Signer#0, fund {} addresses(#{} ~ #{}), each hold {} ERC20",
      n + 1,
      batch_count,
      addresses.len(),
      start_index,
      end_index,
      hold_each_str
    );
    fund_tokens(
      1,
      n,
      batch_count,
      sender.clone(),
      http_provider.clone(),
      token_address,
      contract_address,
      addresses,
      holding_each,
      chain_id,
    )
    .await
    .with_context(|| "Failed to fund tokens".to_string())?;
  }

  anyhow::Ok(())
}

pub async fn fund_erc20_tokens(
  mnemonic: String,
  random_mnemonic: String,
  http_provider: String,
  contract_address: String,
  token_address: String,
  total_sub_accounts: i64,
  per_holding: String,
) -> Result<()> {
  let provider = Provider::<Http>::try_from(http_provider.clone())
    .with_context(|| "Failed to create provider".to_string())?;
  let chain_id = provider
    .get_chainid()
    .await
    .with_context(|| "Failed to get chain id".to_string())?;
  let root_wallet = get_child_signer(&mnemonic, 0, chain_id.low_u64());

  let contract_address: Address = contract_address
    .parse()
    .with_context(|| "Failed to parse contract address".to_string())?;
  let token_address: Address = token_address
    .parse()
    .with_context(|| "Failed to parse token address".to_string())?;
  let per_holding =
    U256::from_dec_str(&per_holding).with_context(|| "Failed to parse per holding".to_string())?;

  let number_of_transactions = total_sub_accounts as usize;

  let batch_count = number_of_transactions / BATCH_SIZE;
  let batch_count = if number_of_transactions % BATCH_SIZE != 0 {
    batch_count + 1
  } else {
    batch_count
  };

  let level_1_start_index = 1;
  let level_1_end_index = level_1_start_index + batch_count - 1;

  // fund signer from 1 to batch_count
  prefund(
    root_wallet,
    mnemonic.clone(),
    http_provider.clone(),
    level_1_start_index,
    level_1_end_index,
    per_holding,
    token_address,
    contract_address,
    chain_id,
  )
  .await
  .with_context(|| "Failed to prefund".to_string())?;

  let mut set = tokio::task::JoinSet::new();
  let mut remain_accounts: usize = total_sub_accounts as usize;

  let all_signers =
    get_child_signers(&random_mnemonic, total_sub_accounts + 1, chain_id.low_u64()).await;

  for batch_index in 0..batch_count {
    let all_signers = all_signers.clone();
    let http_provider = http_provider.clone();

    let sender = get_child_signer(&mnemonic, batch_index as u32, chain_id.low_u64());

    let start_index = BATCH_SIZE * batch_index + 1;

    let end_index = if remain_accounts < 200 {
      start_index + remain_accounts
    } else {
      start_index + 200
    };

    if remain_accounts < 200 {
      remain_accounts = 0;
    } else {
      remain_accounts -= 200;
    }

    let per_holdings = vec![per_holding; end_index - start_index];

    let to_addresses = all_signers[start_index..end_index]
      .to_vec()
      .iter()
      .map(|x| x.address())
      .collect();
    set.spawn(async move {
      fund_tokens(
        2,
        batch_index,
        batch_count,
        sender,
        http_provider,
        token_address,
        contract_address,
        to_addresses,
        per_holdings,
        chain_id,
      )
      .await
      .with_context(|| "Failed to fund tokens".to_string())
      .unwrap();
      2 + batch_index
    });
  }

  while let Some(res) = set.join_next().await {
    match res {
      Ok(_idx) => {}
      Err(e) => {
        log::error!("[ERC20] Batch funding request failed to join: {}", e);
      }
    }
  }

  log::info!("[ERC20] All batch funding request done.");

  anyhow::Result::Ok(())
}
