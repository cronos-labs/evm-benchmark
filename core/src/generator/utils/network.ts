import { config } from "../config/config.service";


export function getWeb3HTTPProvider() {
    if (config.network.benchmark == true) {
        return config.network.node_url;
    }

    return config.network.layer2.node_url;
}
