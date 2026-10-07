/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use crate::expr::Variable;
use compact_str::CompactString;
use mail_auth::common::resolver::ToReverseName;
use registry::types::ipmask::IpAddrOrMask;
use std::{net::IpAddr, str::FromStr};

pub(crate) fn fn_is_empty(v: Vec<Variable>) -> Variable {
    match &v[0] {
        Variable::String(s) => s.is_empty(),
        Variable::Integer(_) | Variable::Float(_) | Variable::Constant(_) => false,
        Variable::Array(a) => a.is_empty(),
    }
    .into()
}

pub(crate) fn fn_is_number(v: Vec<Variable>) -> Variable {
    matches!(&v[0], Variable::Integer(_) | Variable::Float(_)).into()
}

pub(crate) fn fn_bit_and(v: Vec<Variable>) -> Variable {
    match (v[0].to_integer(), v[1].to_integer()) {
        (Some(lhs), Some(rhs)) => Variable::Integer(lhs & rhs),
        _ => Variable::Integer(0),
    }
}

pub(crate) fn fn_is_ip_addr(v: Vec<Variable>) -> Variable {
    v[0].to_string()
        .as_str()
        .parse::<std::net::IpAddr>()
        .is_ok()
        .into()
}

pub(crate) fn fn_is_ipv4_addr(v: Vec<Variable>) -> Variable {
    v[0].to_string()
        .as_str()
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| matches!(ip, IpAddr::V4(_)))
        .into()
}

pub(crate) fn fn_is_ipv6_addr(v: Vec<Variable>) -> Variable {
    v[0].to_string()
        .as_str()
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| matches!(ip, IpAddr::V6(_)))
        .into()
}

pub(crate) fn fn_is_ip_in_cidr(v: Vec<Variable>) -> Variable {
    let Ok(ip) = v[0].to_string().as_str().parse::<IpAddr>() else {
        return false.into();
    };
    IpAddrOrMask::from_str(v[1].to_string().as_str())
        .map(|mask| mask.matches(&ip))
        .unwrap_or(false)
        .into()
}

pub(crate) fn fn_ip_reverse_name(v: Vec<Variable>) -> Variable {
    CompactString::new(
        v[0].to_string()
            .as_str()
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.to_reverse_name())
            .unwrap_or_default(),
    )
    .into()
}

pub(crate) fn fn_if_then(v: Vec<Variable>) -> Variable {
    let mut v = v.into_iter();
    let condition = v.next().unwrap();
    let iff = v.next().unwrap();
    let then = v.next().unwrap();

    if condition.to_bool() { iff } else { then }
}

#[cfg(test)]
mod tests {
    use super::fn_bit_and;
    use crate::expr::Variable;

    fn bit_and(left: Variable, right: Variable) -> i64 {
        match fn_bit_and(vec![left, right]) {
            Variable::Integer(value) => value,
            other => panic!("bit_and returned {other:?}"),
        }
    }

    #[test]
    fn bit_and_matches_dnsbl_octet_masks() {
        assert_eq!(bit_and(Variable::Integer(16), Variable::Integer(16)), 16);
        assert_eq!(bit_and(Variable::Integer(8), Variable::Integer(16)), 0);
        assert_eq!(bit_and(Variable::Integer(24), Variable::Integer(16)), 16);
        assert_eq!(bit_and(Variable::Integer(127), Variable::Integer(2)), 2);
        assert_eq!(bit_and(Variable::Integer(1), Variable::Integer(2)), 0);
        assert_eq!(
            bit_and(
                Variable::String(crate::expr::StringCow::Borrowed("nope")),
                Variable::Integer(16)
            ),
            0
        );
    }
}
