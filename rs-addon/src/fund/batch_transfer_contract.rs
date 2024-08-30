use std::sync::Arc;

use anyhow::{Context, Result};
use ethers::prelude::*;

abigen!(
  BatchTransferV1,
  r#"[
        function multisendNative(address[] calldata _contributors, uint256[] calldata _amounts) external payable
        function multisendToken(address token, address[] calldata _contributors, uint256[] calldata _amounts) external 
    ]"#,
);

abigen!(
  ERC20,
  r#"[
        function balanceOf(address account) external view returns (uint256)
        function approve(address spender, uint256 value) external returns (bool)
        function transfer(address to, uint256 value) external returns (bool)
    ]"#,
);

pub const BATCH_SIZE: usize = 200;

pub struct EstimateGas {
  pub gas: U256,
  pub fee: U256,
}

pub async fn estimate_gas_native(
  signer: LocalWallet,
  http_provider: String,
  contract_address: String,
  contributors: Vec<Address>,
  amounts: Vec<U256>,
) -> Result<EstimateGas> {
  let provider = Provider::<Http>::try_from(http_provider)
    .with_context(|| "Failed to create provider".to_string())?;

  let client = SignerMiddleware::new(provider.clone(), signer);
  let batch_transfer_address: Address = contract_address
    .parse()
    .with_context(|| "Failed to parse contract address".to_string())?;
  let client = Arc::new(client);
  let contract = BatchTransferV1::new(batch_transfer_address, client);

  let total_amount = amounts.iter().fold(U256::zero(), |acc, x| acc + x);

  let estimate_gas = contract
    .multisend_native(contributors, amounts)
    .value(total_amount)
    .estimate_gas()
    .await
    .with_context(|| "Failed to estimate gas".to_string())?;

  let gas_price = provider
    .estimate_eip1559_fees(None)
    .await
    .with_context(|| "Failed to estimate gas price".to_string())?;
  Ok(EstimateGas {
    gas: estimate_gas,
    fee: estimate_gas * gas_price.0,
  })
}

pub async fn estimate_gas_erc20(
  signer: LocalWallet,
  http_provider: String,
  token_address: Address,
  contract_address: Address,
  contributors: Vec<Address>,
  amounts: Vec<U256>,
) -> Result<EstimateGas> {
  let provider = Provider::<Http>::try_from(http_provider)
    .with_context(|| "Failed to create provider".to_string())?;

  let client = SignerMiddleware::new(provider.clone(), signer);
  let client = Arc::new(client);
  let contract = BatchTransferV1::new(contract_address, client);

  let estimate_gas = contract
    .multisend_token(token_address, contributors, amounts)
    .estimate_gas()
    .await
    .with_context(|| "Failed to estimate gas".to_string())?;

  let gas_price = provider
    .estimate_eip1559_fees(None)
    .await
    .with_context(|| "Failed to estimate gas price".to_string())?;

  Ok(EstimateGas {
    gas: estimate_gas,
    fee: estimate_gas * gas_price.0,
  })
}
