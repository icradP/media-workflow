/**
 * H.265/HEVC NAL unit header reader + Profile Tier Level parser.
 */

import { BitReader } from '../binary/reader.js';
import type { HevcProfileTierLevel } from '../types.js';
import { getHEVCProfileName, getHEVCLevelName, getHEVCTierName } from './constants.js';

export interface HevcNalHeader {
  forbidden_zero_bit: number;
  nal_unit_type: number;
  nal_unit_type_name: string;
  nuh_layer_id: number;
  nuh_temporal_id_plus1: number;
}

export function readHevcNalUnitHeader(reader: BitReader): HevcNalHeader {
  return {
    forbidden_zero_bit: reader.readBits(1, 'forbidden_zero_bit'),
    nal_unit_type: reader.readBits(6, 'nal_unit_type'),
    nal_unit_type_name: '',
    nuh_layer_id: reader.readBits(6, 'nuh_layer_id'),
    nuh_temporal_id_plus1: reader.readBits(3, 'nuh_temporal_id_plus1'),
  };
}

export function readHevcProfileTierLevel(reader: BitReader, prefix: string): HevcProfileTierLevel {
  const prev = reader.prefix;
  reader.prefix = prefix ? `${prefix}.profile_tier_level` : 'profile_tier_level';

  const p: HevcProfileTierLevel = {
    general_profile_space: reader.readBits(2),
    general_tier_flag: '',
    generalTierFlagValue: 0,
    general_profile_idc: '',
    generalProfileIdcValue: 0,
    general_profile_compatibility_flags: {},
    general_progressive_source_flag: 0,
    general_interlaced_source_flag: 0,
    general_non_packed_constraint_flag: 0,
    general_frame_only_constraint_flag: 0,
    general_level_idc: '',
    generalLevelIdcValue: 0,
  };

  const tierFlag = reader.readBits(1);
  p.general_tier_flag = `${tierFlag} (${getHEVCTierName(tierFlag)})`;
  p.generalTierFlagValue = tierFlag;

  const profileIdc = reader.readBits(5);
  p.general_profile_idc = `${profileIdc} (${getHEVCProfileName(profileIdc)})`;
  p.generalProfileIdcValue = profileIdc;

  for (let i = 0; i < 32; i++) {
    p.general_profile_compatibility_flags[`flag[${i}]`] = reader.readBits(1);
  }

  p.general_progressive_source_flag = reader.readBits(1);
  p.general_interlaced_source_flag = reader.readBits(1);
  p.general_non_packed_constraint_flag = reader.readBits(1);
  p.general_frame_only_constraint_flag = reader.readBits(1);
  p.general_reserved_zero_7bits = reader.readBits(7, 'general_reserved_zero_7bits');
  p.general_one_picture_only_constraint_flag = reader.readBits(1, 'general_one_picture_only_constraint_flag');

  reader.startField('general_reserved_zero_35bits');
  const r1 = reader.readBitsRaw(32), r2 = reader.readBitsRaw(3);
  reader.finishField('general_reserved_zero_35bits');
  p.general_reserved_zero_35bits = `${r1.toString(16).padStart(8, '0')}${r2.toString(16).padStart(1, '0')}`;

  p.general_inbld_flag = reader.readBits(1, 'general_inbld_flag');
  const levelIdc = reader.readBits(8);
  p.general_level_idc = `${levelIdc} (${getHEVCLevelName(levelIdc)})`;
  p.generalLevelIdcValue = levelIdc;

  reader.prefix = prev;
  return p;
}
