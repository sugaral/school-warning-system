<template>
	<xn-form-container
		:title="formData.id ? '编辑学生档案' : '新增学生档案'"
		:width="580"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="学号：" name="studentNo">
						<a-input v-model:value="formData.studentNo" placeholder="请输入学号" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="姓名：" name="name">
						<a-input v-model:value="formData.name" placeholder="请输入姓名" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="所属班级：" name="classId">
						<a-select
							v-model:value="formData.classId"
							:options="classOptions"
							:field-names="{ label: 'className', value: 'id' }"
							placeholder="请选择班级"
							show-search
							option-filter-prop="className"
						/>
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="性别：" name="gender">
						<a-select v-model:value="formData.gender" placeholder="请选择性别" allow-clear>
							<a-select-option value="男">男</a-select-option>
							<a-select-option value="女">女</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="手机号：" name="mobile">
						<a-input v-model:value="formData.mobile" placeholder="请输入手机号" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="邮箱：" name="email">
						<a-input v-model:value="formData.email" placeholder="请输入邮箱" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="紧急联系人：" name="emergencyContactName">
						<a-input v-model:value="formData.emergencyContactName" placeholder="选填" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="紧急联系电话：" name="emergencyContactMobile">
						<a-input v-model:value="formData.emergencyContactMobile" placeholder="选填" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="学生职务：" name="studentPosition">
						<a-input v-model:value="formData.studentPosition" placeholder="如：班长/学习委员" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="学籍状态：" name="status">
						<a-select v-model:value="formData.status">
							<a-select-option value="active">在读</a-select-option>
							<a-select-option value="inactive">停用</a-select-option>
							<a-select-option value="graduated">已毕业</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item v-if="!formData.id" label="初始密码（留空则系统生成强密码，提交前自动SM2加密）：" name="plainPassword">
				<a-input-password v-model:value="formData.plainPassword" placeholder="至少8位或留空自动生成" allow-clear />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizStudentForm">
	import { required } from '@/utils/formRules'
	import smCrypto from '@/utils/smCrypto'
	import bizStudentApi from '@/api/biz/bizStudentApi'
	import bizClassApi from '@/api/biz/bizClassApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const classOptions = ref([])

	const formRules = {
		studentNo: [required('请输入学号')],
		name: [required('请输入学生姓名')],
		classId: [required('请选择所属班级')]
	}

	const onOpen = (record, classId) => {
		visible.value = true
		formData.value = { status: 'active' }
		if (classId) formData.value.classId = classId
		if (record) formData.value = Object.assign({}, record)
		bizClassApi.clazzList().then((res) => {
			classOptions.value = res || []
		})
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				const payload = { ...formData.value }
				if (!payload.id && payload.plainPassword) {
					payload.password = smCrypto.doSm2Encrypt(payload.plainPassword)
				}
				delete payload.plainPassword
				bizStudentApi
					.submitForm(payload, !!payload.id)
					.then((res) => {
						visible.value = false
						emit('successful', res)
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
