/*
 * Copyright [2022] [https://www.xiaonuo.vip]
 *
 * Snowy采用APACHE LICENSE 2.0开源协议，您在使用过程中，需要注意以下几点：
 *
 * 1.请不要删除和修改根目录下的LICENSE文件。
 * 2.请不要删除和修改Snowy源码头部的版权声明。
 * 3.本项目代码可免费商业使用，商业使用请保留源码和相关描述文件的项目出处，作者声明等。
 * 4.分发源码时候，请注明软件出处 https://www.xiaonuo.vip
 * 5.不可二次分发开源参与同类竞品，如有想法可联系团队xiaonuobase@qq.com商议合作。
 * 6.若您的项目无法满足以上几点，需要更多功能代码，获取Snowy商业授权许可，请在官网购买授权，地址为 https://www.xiaonuo.vip
 */
package vip.xiaonuo.client.modular.user.provider;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollectionUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.auth.api.AuthApi;
import vip.xiaonuo.auth.core.util.StpClientUtil;
import vip.xiaonuo.client.ClientUserApi;
import vip.xiaonuo.client.modular.user.entity.ClientUser;
import vip.xiaonuo.client.modular.user.enums.ClientUserSourceFromTypeEnum;
import vip.xiaonuo.client.modular.user.enums.ClientUserStatusEnum;
import vip.xiaonuo.client.modular.user.param.ClientUserAddParam;
import vip.xiaonuo.client.modular.user.param.ClientUserEditParam;
import vip.xiaonuo.client.modular.user.param.ClientUserIdParam;
import vip.xiaonuo.client.modular.user.service.ClientUserService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.util.CommonCryptogramUtil;

import java.util.HashSet;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 用户API接口提供者
 *
 * @author xuyuxiang
 * @date 2022/6/20 18:24
 **/
@Service
public class ClientUserApiProvider implements ClientUserApi {

    @Resource
    private ClientUserService clientUserService;

    @Resource
    private AuthApi authApi;

    @Override
    public JSONObject getUserByIdWithoutException(String userId) {
        ClientUser clientUser = clientUserService.getById(userId);
        if(ObjectUtil.isNotEmpty(clientUser)) {
            return JSONUtil.parseObj(clientUser);
        }
        return null;
    }

    @Override
    public List<JSONObject> getUserListByIdListWithoutException(List<String> userIdList) {
        return clientUserService.listByIds(userIdList).stream().map(JSONUtil::parseObj).collect(Collectors.toList());
    }

    @Override
    public JSONObject getUserByIdWithException(String userId) {
        return JSONUtil.parseObj(clientUserService.queryEntity(userId));
    }

    @Override
    public List<JSONObject> getUserListByIdWithException(List<String> userIdList) {
        HashSet<String> userIdSet = CollectionUtil.newHashSet(userIdList);
        List<ClientUser> clientUserList = clientUserService.listByIds(userIdSet);
        if(clientUserList.size() != userIdSet.size()) {
            throw new CommonException("某用户不存在，id值集合为：{}", userIdSet);
        }
        return clientUserList.stream().map(JSONUtil::parseObj).collect(Collectors.toList());
    }

    @Override
    public List<JSONObject> listUserWithoutCurrent() {
        return clientUserService.list(new LambdaQueryWrapper<ClientUser>()
                .select(ClientUser::getId, ClientUser::getAccount, ClientUser::getName, ClientUser::getAvatar)
                .ne(ClientUser::getId, StpUtil.getLoginId()))
                .stream().map(JSONUtil::parseObj).collect(Collectors.toList());
    }

    @Override
    public JSONObject getOrCreateClientUserExt(String userId) {
        return JSONUtil.parseObj(clientUserService.getOrCreateClientUserExt(userId));
    }

    @Override
    public List<JSONObject> userSelector(String searchKey) {
        LambdaQueryWrapper<ClientUser> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.select(ClientUser::getId, ClientUser::getName, ClientUser::getAccount, ClientUser::getAvatar);
        if (ObjectUtil.isNotEmpty(searchKey)) {
            queryWrapper.and(w -> w
                    .like(ClientUser::getName, searchKey)
                    .or().like(ClientUser::getAccount, searchKey));
        }
        queryWrapper.orderByAsc(ClientUser::getSortCode);
        return clientUserService.list(queryWrapper).stream().map(JSONUtil::parseObj).collect(Collectors.toList());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public String createStudentClientUser(String account, String name, String phone, String email, String gender, String rawPassword) {
        ClientUserAddParam param = new ClientUserAddParam();
        param.setAccount(account);
        param.setName(name);
        param.setPhone(StrUtil.blankToDefault(phone, null));
        param.setEmail(StrUtil.blankToDefault(email, null));
        param.setGender(StrUtil.blankToDefault(gender, null));
        param.setPassword(rawPassword);
        ClientUser created = clientUserService.add(param, ClientUserSourceFromTypeEnum.SYSTEM_ADD.getValue());
        return created.getId();
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void updateStudentClientUser(String userId, String account, String name, String phone, String email, String gender, String status) {
        ClientUser existing = clientUserService.getById(userId);
        if (ObjectUtil.isEmpty(existing)) {
            throw new CommonException("关联C端用户不存在，id={}", userId);
        }
        ClientUserEditParam param = new ClientUserEditParam();
        param.setId(userId);
        param.setAccount(StrUtil.blankToDefault(account, existing.getAccount()));
        param.setName(StrUtil.blankToDefault(name, existing.getName()));
        param.setPhone(phone);
        param.setEmail(email);
        param.setGender(gender);
        clientUserService.edit(param);

        if (StrUtil.isNotBlank(status)) {
            ClientUserIdParam idParam = new ClientUserIdParam();
            idParam.setId(userId);
            if ("active".equalsIgnoreCase(status) || ClientUserStatusEnum.ENABLE.getValue().equalsIgnoreCase(status)) {
                clientUserService.enableUser(idParam);
            } else {
                clientUserService.disableUser(idParam);
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void deleteStudentClientUsers(List<String> userIdList) {
        if (ObjectUtil.isEmpty(userIdList)) {
            return;
        }
        List<ClientUserIdParam> params = userIdList.stream().map(id -> {
            ClientUserIdParam p = new ClientUserIdParam();
            p.setId(id);
            return p;
        }).collect(Collectors.toList());
        clientUserService.delete(params);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void resetStudentPassword(String userId, String newRawPassword) {
        ClientUser existing = clientUserService.getById(userId);
        if (ObjectUtil.isEmpty(existing)) {
            throw new CommonException("关联C端用户不存在，id={}", userId);
        }
        clientUserService.update(new LambdaUpdateWrapper<ClientUser>()
                .eq(ClientUser::getId, userId)
                .set(ClientUser::getPassword, CommonCryptogramUtil.doHashValue(newRawPassword)));
        StpClientUtil.kickout(userId);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void unbindStudentWechat(String userId) {
        if (StrUtil.isNotBlank(userId)) {
            authApi.removeThirdUserByUserIdList(CollectionUtil.newArrayList(userId));
        }
    }
}
